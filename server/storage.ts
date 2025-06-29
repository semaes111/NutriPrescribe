import { 
  patients, 
  dietLevels, 
  mealPlans, 
  recipes, 
  foodItems,
  intermittentFasting,
  moodEntries,
  users,
  professionals,
  weightRecords,
  type Patient, 
  type InsertPatient,
  type DietLevel,
  type MealPlan,
  type Recipe,
  type FoodItem,
  type IntermittentFasting,
  type InsertIntermittentFasting,
  type MoodEntry,
  type InsertMoodEntry,
  type User,
  type UpsertUser
} from "@shared/schema";
import { db } from "./db";
import { eq, and, gte, desc } from "drizzle-orm";

export interface IStorage {
  // User operations (mandatory for Replit Auth)
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  
  // Professional operations
  getProfessionalByUserId(userId: string): Promise<any>;
  getProfessionalByAccessCode(accessCode: string): Promise<any>;
  createProfessional(professional: any): Promise<any>;
  
  // Patient operations
  getPatientByAccessCode(accessCode: string): Promise<Patient | undefined>;
  getPatientByUserId(userId: string): Promise<Patient | undefined>;
  getPatientById(patientId: number): Promise<Patient | undefined>;
  getAllPatients(): Promise<Patient[]>;
  createPatient(patient: InsertPatient): Promise<Patient>;
  updatePatient(patientId: number, updates: Partial<Patient>): Promise<void>;
  updatePatientDietLevel(patientId: number, dietLevel: number): Promise<void>;
  updatePatientUserId(patientId: number, userId: string): Promise<void>;
  
  // Weight tracking
  getWeightRecordsByPatient(patientId: number): Promise<any[]>;
  addWeightRecord(weightRecord: any): Promise<any>;
  updatePatientAccessCode(patientId: number, accessCode: string, codeExpiry: Date): Promise<void>;
  updatePatientTargetWeight(patientId: number, targetWeight: number): Promise<void>;
  
  // Diet operations
  getDietLevels(): Promise<DietLevel[]>;
  getMealPlansByDietLevel(dietLevelId: number): Promise<MealPlan[]>;
  getRecipesByMealPlan(mealPlanId: number): Promise<Recipe[]>;
  getFoodItemsByCategory(category: string): Promise<FoodItem[]>;
  
  // Intermittent fasting
  getIntermittentFastingByPatient(patientId: number): Promise<IntermittentFasting | undefined>;
  createIntermittentFasting(fasting: InsertIntermittentFasting): Promise<IntermittentFasting>;
  
  // Mood tracking
  getMoodEntriesByPatient(patientId: number): Promise<MoodEntry[]>;
  createMoodEntry(moodEntry: InsertMoodEntry): Promise<MoodEntry>;
  getRecentMoodEntry(patientId: number): Promise<MoodEntry | undefined>;
}

export class DatabaseStorage implements IStorage {
  // User operations (mandatory for Replit Auth)
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async getPatientByAccessCode(accessCode: string): Promise<Patient | undefined> {
    const [patient] = await db
      .select()
      .from(patients)
      .where(
        and(
          eq(patients.accessCode, accessCode),
          eq(patients.isActive, true),
          gte(patients.codeExpiry, new Date())
        )
      );
    return patient || undefined;
  }

  async getPatientByUserId(userId: string): Promise<Patient | undefined> {
    const [patient] = await db
      .select()
      .from(patients)
      .where(
        and(
          eq(patients.userId, userId),
          eq(patients.isActive, true),
          gte(patients.codeExpiry, new Date())
        )
      );
    return patient || undefined;
  }

  async createPatient(insertPatient: InsertPatient): Promise<Patient> {
    const [patient] = await db
      .insert(patients)
      .values([insertPatient])
      .returning();
    return patient;
  }

  async updatePatientDietLevel(patientId: number, dietLevel: number): Promise<void> {
    await db
      .update(patients)
      .set({ dietLevel })
      .where(eq(patients.id, patientId));
  }

  async updatePatientUserId(patientId: number, userId: string): Promise<void> {
    await db
      .update(patients)
      .set({ userId })
      .where(eq(patients.id, patientId));
  }

  async updatePatientAccessCode(patientId: number, accessCode: string, codeExpiry: Date): Promise<void> {
    await db
      .update(patients)
      .set({ 
        accessCode,
        codeExpiry
      })
      .where(eq(patients.id, patientId));
  }

  async updatePatientTargetWeight(patientId: number, targetWeight: number): Promise<void> {
    await db
      .update(patients)
      .set({ targetWeight: targetWeight.toString() })
      .where(eq(patients.id, patientId));
  }

  // Professional operations
  async getProfessionalByUserId(userId: string): Promise<any> {
    const [professional] = await db
      .select()
      .from(professionals)
      .where(eq(professionals.userId, userId));
    return professional;
  }

  async getProfessionalByAccessCode(accessCode: string): Promise<any> {
    console.log("Storage: Looking for professional with access code:", accessCode);
    const [professional] = await db
      .select()
      .from(professionals)
      .where(eq(professionals.accessCode, accessCode));
    console.log("Storage: Professional result:", professional);
    return professional;
  }

  async createProfessional(insertProfessional: any): Promise<any> {
    const [professional] = await db
      .insert(professionals)
      .values(insertProfessional)
      .returning();
    return professional;
  }

  async getPatientById(patientId: number): Promise<Patient | undefined> {
    const [patient] = await db
      .select()
      .from(patients)
      .where(eq(patients.id, patientId));
    return patient;
  }

  async getAllPatients(): Promise<Patient[]> {
    return await db
      .select()
      .from(patients)
      .where(eq(patients.isActive, true))
      .orderBy(desc(patients.createdAt));
  }

  async updatePatient(patientId: number, updates: Partial<InsertPatient>): Promise<void> {
    await db
      .update(patients)
      .set(updates)
      .where(eq(patients.id, patientId));
  }

  // Weight tracking
  async getWeightRecordsByPatient(patientId: number): Promise<any[]> {
    return await db
      .select()
      .from(weightRecords)
      .where(eq(weightRecords.patientId, patientId))
      .orderBy(desc(weightRecords.recordedDate));
  }

  async addWeightRecord(insertWeightRecord: any): Promise<any> {
    try {
      console.log("Storage: Adding weight record:", insertWeightRecord);
      
      // Ensure proper data types and defaults
      const recordData = {
        patientId: parseInt(insertWeightRecord.patientId),
        weight: insertWeightRecord.weight.toString(),
        notes: insertWeightRecord.notes || null,
        recordedDate: insertWeightRecord.recordedDate || new Date()
      };
      
      const [weightRecord] = await db
        .insert(weightRecords)
        .values(recordData)
        .returning();
      
      console.log("Storage: Weight record created:", weightRecord);
      return weightRecord;
    } catch (error) {
      console.error("Storage: Error adding weight record:", error);
      throw error;
    }
  }

  async getDietLevels(): Promise<DietLevel[]> {
    return await db
      .select()
      .from(dietLevels)
      .where(eq(dietLevels.isActive, true))
      .orderBy(dietLevels.level);
  }

  async getMealPlansByDietLevel(dietLevelId: number): Promise<MealPlan[]> {
    return await db
      .select()
      .from(mealPlans)
      .where(
        and(
          eq(mealPlans.dietLevelId, dietLevelId),
          eq(mealPlans.isActive, true)
        )
      );
  }

  async getRecipesByMealPlan(mealPlanId: number): Promise<Recipe[]> {
    return await db
      .select()
      .from(recipes)
      .where(
        and(
          eq(recipes.mealPlanId, mealPlanId),
          eq(recipes.isActive, true)
        )
      );
  }

  async getFoodItemsByCategory(category: string): Promise<FoodItem[]> {
    return await db
      .select()
      .from(foodItems)
      .where(
        and(
          eq(foodItems.category, category),
          eq(foodItems.isActive, true)
        )
      );
  }

  async getIntermittentFastingByPatient(patientId: number): Promise<IntermittentFasting | undefined> {
    const [fasting] = await db
      .select()
      .from(intermittentFasting)
      .where(
        and(
          eq(intermittentFasting.patientId, patientId),
          eq(intermittentFasting.isActive, true)
        )
      )
      .orderBy(desc(intermittentFasting.createdAt));
    return fasting || undefined;
  }

  async createIntermittentFasting(insertFasting: InsertIntermittentFasting): Promise<IntermittentFasting> {
    const [fasting] = await db
      .insert(intermittentFasting)
      .values([insertFasting])
      .returning();
    return fasting;
  }

  // Mood tracking methods
  async getMoodEntriesByPatient(patientId: number): Promise<MoodEntry[]> {
    const entries = await db
      .select()
      .from(moodEntries)
      .where(eq(moodEntries.patientId, patientId))
      .orderBy(desc(moodEntries.recordedDate));
    return entries;
  }

  async createMoodEntry(insertMoodEntry: InsertMoodEntry): Promise<MoodEntry> {
    const [entry] = await db
      .insert(moodEntries)
      .values(insertMoodEntry)
      .returning();
    return entry;
  }

  async getRecentMoodEntry(patientId: number): Promise<MoodEntry | undefined> {
    const [entry] = await db
      .select()
      .from(moodEntries)
      .where(eq(moodEntries.patientId, patientId))
      .orderBy(desc(moodEntries.recordedDate))
      .limit(1);
    return entry;
  }
}

export const storage = new DatabaseStorage();
